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
    buffer: Vec<u8>,
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
            buffer: Vec::new(),
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.file_name.clear();
        self.file_size = 0;
        self.file_data.clear();
        self.phase = Phase::Idle;
        self.buffer.clear();
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

    fn find_header(buf: &[u8]) -> Option<usize> {
        for i in 0..buf.len().saturating_sub(2) {
            if buf[i] == ZPAD && buf[i + 1] == ZPAD && buf[i + 2] == ZDLE {
                if i + 3 < buf.len() {
                    let c = buf[i + 3];
                    if c == b'B' || c == b'@' || c == b'C' || c == b'b' || c == b'c' {
                        return Some(i);
                    }
                }
            }
        }
        None
    }

    fn parse_header_at(buf: &[u8], start: usize) -> Option<(u8, u32)> {
        let hex_start = start + 4;
        if buf.len() >= hex_start + 12 {
            let frame_type = Self::hex_byte(buf[hex_start], buf[hex_start + 1])?;
            let mut val: u32 = 0;
            for j in (hex_start + 2..hex_start + 8).step_by(2) {
                let b = Self::hex_byte(buf[j], buf[j + 1])?;
                val = (val << 8) | (b as u32);
            }
            return Some((frame_type, val));
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

    fn make_zrinit_response() -> Vec<u8> {
        Self::make_header(ZRINIT, [0, 0, 0])
    }

    fn drain_buffered_frames(&mut self) -> Option<ZmodemAction> {
        loop {
            let header_pos = match Self::find_header(&self.buffer) {
                Some(p) => p,
                None => {
                    if !self.buffer.is_empty() {
                        eprintln!("[ZMODEM] rx: no header in {} bytes: {:?}", self.buffer.len(),
                            self.buffer.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" "));
                    }
                    return None;
                }
            };

            if header_pos > 0 {
                eprintln!("[ZMODEM] rx: discarding {} non-zmodem bytes before header", header_pos);
                self.buffer.drain(..header_pos);
            }

            match Self::parse_header_at(&self.buffer, 0) {
                Some((frame_type, val)) => {
                    eprintln!("[ZMODEM] frame=0x{:02x} val=0x{:08x}", frame_type, val);
                    let consumed = 4 + 12;
                    self.buffer.drain(..consumed);

                    match self.process_frame(frame_type, val) {
                        action @ ZmodemAction::SendToChannel(_) |
                        action @ ZmodemAction::Finished(_) => return Some(action),
                        ZmodemAction::None => continue,
                        action => return Some(action),
                    }
                }
                None => {
                    eprintln!("[ZMODEM] rx: incomplete header ({} bytes in buffer)", self.buffer.len());
                    return None;
                }
            }
        }
    }

    fn process_frame(&mut self, frame_type: u8, _val: u32) -> ZmodemAction {
        match frame_type {
            ZRQINIT => {
                self.phase = Phase::WaitFile;
                ZmodemAction::SendToChannel(Self::make_zrinit_response())
            }
            ZFILE => {
                self.phase = Phase::Receiving;
                ZmodemAction::SendToChannel(Self::make_header(ZRPOS, [0, 0, 0]))
            }
            ZDATA => {
                ZmodemAction::SendToChannel(Self::make_header(ZACK, [0, 0, 0]))
            }
            ZEOF => {
                self.phase = Phase::Done;
                ZmodemAction::SendToChannel(Self::make_header(ZRINIT, [0, 0, 0]))
            }
            ZFIN => {
                let resp = Self::make_header(ZFIN, [0, 0, 0]);
                self.reset();
                ZmodemAction::Finished(resp)
            }
            ZNAK => {
                ZmodemAction::SendToChannel(Self::make_header(ZRINIT, [0, 0, 0]))
            }
            _ => {
                ZmodemAction::SendToChannel(Self::make_header(ZACK, [0, 0, 0]))
            }
        }
    }

    pub fn handle(&mut self, data: &[u8]) -> ZmodemAction {
        if !self.active {
            if Self::is_zmodem(data) {
                self.active = true;
                eprintln!("[ZMODEM] Detected start in {} bytes", data.len());
                self.buffer.extend_from_slice(data);
                return match self.drain_buffered_frames() {
                    Some(action) => action,
                    None => ZmodemAction::None,
                };
            }
            return ZmodemAction::PassThrough;
        }

        self.buffer.extend_from_slice(data);
        eprintln!("[ZMODEM] rx: {} bytes ({} total in buffer) hex: {}", data.len(), self.buffer.len(),
            self.buffer.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" "));

        match self.drain_buffered_frames() {
            Some(action) => action,
            None => {
                if self.phase == Phase::Receiving || self.phase == Phase::WaitFile {
                    let chunk: Vec<u8> = self.buffer.drain(..).collect();
                    if !chunk.is_empty() {
                        self.file_data.extend_from_slice(&chunk);
                        return ZmodemAction::FileData(chunk);
                    }
                }
                ZmodemAction::None
            }
        }
    }
}

pub enum ZmodemAction {
    None,
    PassThrough,
    SendToChannel(Vec<u8>),
    FileData(Vec<u8>),
    Finished(Vec<u8>),
}
