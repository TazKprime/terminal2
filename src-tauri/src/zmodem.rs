use std::io::Write;

const ZPAD: u8 = 0x2a;
const ZDLE: u8 = 0x18;

const ZRQINIT: u8 = 0x00;
const ZRINIT: u8 = 0x01;
const ZACK: u8 = 0x03;
const ZFILE: u8 = 0x04;
const ZNAK: u8 = 0x06;
const ZFIN: u8 = 0x08;
const ZRPOS: u8 = 0x09;
const ZDATA: u8 = 0x0a;
const ZEOF: u8 = 0x0b;

const HEX: &[u8] = b"0123456789abcdef";

pub struct ZmodemHandler {
    pub active: bool,
    pub file_name: String,
    pub file_size: u64,
    pub file_data: Vec<u8>,
    pub phase: Phase,
}

#[derive(PartialEq, Clone, Copy)]
pub enum Phase {
    Idle,
    WaitFile,
    Receiving,
    Done,
}

impl ZmodemHandler {
    pub fn new() -> Self {
        Self {
            active: false,
            file_name: String::new(),
            file_size: 0,
            file_data: Vec::new(),
            phase: Phase::Idle,
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.file_name.clear();
        self.file_size = 0;
        self.file_data.clear();
        self.phase = Phase::Idle;
    }

    pub fn is_zmodem(data: &[u8]) -> bool {
        for i in 0..data.len().saturating_sub(2) {
            if data[i] == ZPAD && data[i + 1] == ZPAD {
                if i + 2 < data.len() && data[i + 2] == ZDLE {
                    if i + 3 < data.len() {
                        let c = data[i + 3];
                        return c == b'B' || c == b'@' || c == b'C' || c == b'b' || c == b'c';
                    }
                }
            }
        }
        false
    }

    fn hex_digit(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    }

    fn hex_byte(hi: u8, lo: u8) -> Option<u8> {
        Some((Self::hex_digit(hi)? << 4) | Self::hex_digit(lo)?)
    }

    fn parse_header(data: &[u8]) -> Option<(u8, u32)> {
        let mut i = 0;
        while i + 3 < data.len() {
            if data[i] == ZPAD && data[i + 1] == ZPAD && data[i + 2] == ZDLE {
                let hex_start = i + 4;
                if data.len() >= hex_start + 12 {
                    let frame_type = Self::hex_byte(data[hex_start], data[hex_start + 1])?;
                    let mut val: u32 = 0;
                    for j in (hex_start + 2..hex_start + 8).step_by(2) {
                        let b = Self::hex_byte(data[j], data[j + 1])?;
                        val = (val << 8) | (b as u32);
                    }
                    return Some((frame_type, val));
                }
            }
            i += 1;
        }
        None
    }

    fn crc16(data: &[u8]) -> u16 {
        let table: [u16; 256] = Self::build_crc_table();
        let mut crc: u16 = 0;
        for &byte in data {
            crc = table[((crc >> 8) ^ byte as u16) as usize] ^ (crc << 8);
        }
        crc
    }

    fn build_crc_table() -> [u16; 256] {
        let mut table = [0u16; 256];
        for i in 0..256u16 {
            let mut crc = i << 8;
            for _ in 0..8 {
                if crc & 0x8000 != 0 {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc <<= 1;
                }
            }
            table[i as usize] = crc;
        }
        table
    }

    fn make_header(frame_type: u8, payload: [u8; 3]) -> Vec<u8> {
        let mut frame_bytes = Vec::with_capacity(4);
        frame_bytes.push(frame_type);
        frame_bytes.extend_from_slice(&payload);
        let crc = Self::crc16(&frame_bytes);

        let mut out = Vec::with_capacity(18);
        out.extend_from_slice(&[ZPAD, ZPAD, ZDLE, b'B']);

        for &b in &frame_bytes {
            out.push(HEX[((b >> 4) & 0x0f) as usize]);
            out.push(HEX[(b & 0x0f) as usize]);
        }

        let crch = ((crc >> 8) & 0xff) as u8;
        let crcl = (crc & 0xff) as u8;
        out.push(HEX[((crch >> 4) & 0x0f) as usize]);
        out.push(HEX[(crch & 0x0f) as usize]);
        out.push(HEX[((crcl >> 4) & 0x0f) as usize]);
        out.push(HEX[(crcl & 0x0f) as usize]);

        out
    }

    pub fn handle(&mut self, data: &[u8]) -> ZmodemAction {
        if !self.active {
            if Self::is_zmodem(data) {
                self.active = true;
                eprintln!("[ZMODEM] Detected start in {} bytes", data.len());
                let resp = Self::make_header(ZRINIT, [0, 0, 0]);
                eprintln!("[ZMODEM] -> ZRINIT ({} bytes): {:?}", resp.len(), &resp[..16]);
                return ZmodemAction::SendToChannel(resp);
            }
            return ZmodemAction::PassThrough;
        }

        if let Some((frame_type, val)) = Self::parse_header(data) {
            eprintln!("[ZMODEM] frame=0x{:02x} val=0x{:08x}", frame_type, val);
            match frame_type {
                ZRQINIT => {
                    self.phase = Phase::WaitFile;
                    let resp = Self::make_header(ZRINIT, [0, 0, 0]);
                    return ZmodemAction::SendToChannel(resp);
                }
                ZFILE => {
                    self.phase = Phase::Receiving;
                    return ZmodemAction::SendToChannel(
                        Self::make_header(ZRPOS, [0, 0, 0])
                    );
                }
                ZDATA => {
                    return ZmodemAction::SendToChannel(
                        Self::make_header(ZACK, [0, 0, 0])
                    );
                }
                ZEOF => {
                    self.phase = Phase::Done;
                    let resp = Self::make_header(ZRINIT, [0, 0, 0]);
                    return ZmodemAction::SendToChannel(resp);
                }
                ZFIN => {
                    let resp = Self::make_header(ZFIN, [0, 0, 0]);
                    self.reset();
                    return ZmodemAction::Finished(resp);
                }
                ZNAK => {
                    return ZmodemAction::SendToChannel(
                        Self::make_header(ZRINIT, [0, 0, 0])
                    );
                }
                _ => {
                    return ZmodemAction::SendToChannel(
                        Self::make_header(ZACK, [0, 0, 0])
                    );
                }
            }
        }

        if self.phase == Phase::Receiving || self.phase == Phase::WaitFile {
            if !Self::is_zmodem(data) && !data.is_empty() {
                self.file_data.extend_from_slice(data);
                return ZmodemAction::FileData(data.to_vec());
            }
        }

        ZmodemAction::None
    }
}

pub enum ZmodemAction {
    None,
    PassThrough,
    SendToChannel(Vec<u8>),
    FileData(Vec<u8>),
    Finished(Vec<u8>),
}
