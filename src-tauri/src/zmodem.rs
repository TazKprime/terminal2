use std::io::{Read, Write};

const ZPAD: u8 = 0x2a;
const ZDLE: u8 = 0x18;
const ZDLEE: u8 = 0x58;

const ZRQINIT: u8 = 0x00;
const ZRINIT: u8 = 0x01;
const ZSINIT: u8 = 0x02;
const ZACK: u8 = 0x03;
const ZFILE: u8 = 0x04;
const ZSKIP: u8 = 0x05;
const ZNAK: u8 = 0x06;
const ZABORT: u8 = 0x07;
const ZFIN: u8 = 0x08;
const ZRPOS: u8 = 0x09;
const ZDATA: u8 = 0x0a;
const ZEOF: u8 = 0x0b;
const ZERR: u8 = 0x0c;
const ZCRC: u8 = 0x0d;
const ZCHALLENGE: u8 = 0x0e;
const ZCOMPL: u8 = 0x0f;
const ZCAN: u8 = 0x18;

pub struct ZmodemHandler {
    pub active: bool,
    pub receiving: bool,
    pub sending: bool,
    pub file_name: String,
    pub file_size: u64,
    pub file_data: Vec<u8>,
    pub save_path: Option<String>,
    pub expecting_file: bool,
    pub phase: ZmodemPhase,
}

#[derive(PartialEq)]
pub enum ZmodemPhase {
    Idle,
    WaitInit,
    WaitFile,
    WaitData,
    Done,
}

impl ZmodemHandler {
    pub fn new() -> Self {
        Self {
            active: false,
            receiving: false,
            sending: false,
            file_name: String::new(),
            file_size: 0,
            file_data: Vec::new(),
            save_path: None,
            expecting_file: false,
            phase: ZmodemPhase::Idle,
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.receiving = false;
        self.sending = false;
        self.file_name.clear();
        self.file_size = 0;
        self.file_data.clear();
        self.save_path = None;
        self.expecting_file = false;
        self.phase = ZmodemPhase::Idle;
    }

    pub fn is_zmodem_start(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        data[0] == ZPAD && data[1] == ZPAD && data[2] == ZDLE &&
        (data[3] == b'B' || data[3] == b'@' || data[3] == b'C')
    }

    fn hex_to_byte(hi: u8, lo: u8) -> Result<u8, ()> {
        fn hex_digit(c: u8) -> Result<u8, ()> {
            match c {
                b'0'..=b'9' => Ok(c - b'0'),
                b'a'..=b'f' => Ok(c - b'a' + 10),
                b'A'..=b'F' => Ok(c - b'A' + 10),
                _ => Err(()),
            }
        }
        Ok((hex_digit(hi)? << 4) | hex_digit(lo)?)
    }

    fn parse_header(data: &[u8]) -> Option<(u8, Vec<u8>)> {
        let header_start = if data.len() > 3 && data[2] == ZDLE { 3 } else { 0 };
        let hex_start = header_start + 1;

        if data.len() < hex_start + 16 {
            return None;
        }

        let frame_type = Self::hex_to_byte(data[hex_start], data[hex_start + 1]).ok()?;
        let mut payload = Vec::new();
        for i in (hex_start + 2..hex_start + 10).step_by(2) {
            payload.push(Self::hex_to_byte(data[i], data[i + 1]).ok()?);
        }
        Some((frame_type, payload))
    }

    fn crc16(data: &[u8]) -> u16 {
        let mut crc: u16 = 0;
        for &byte in data {
            crc ^= (byte as u16) << 8;
            for _ in 0..8 {
                if crc & 0x8000 != 0 {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc <<= 1;
                }
            }
        }
        crc
    }

    fn build_header(frame_type: u8, data: [u8; 4]) -> Vec<u8> {
        let mut header = Vec::new();
        header.push(ZPAD);
        header.push(ZPAD);
        header.push(ZDLE);
        header.push(b'B');

        let hex_chars = b"0123456789abcdef";
        header.push(hex_chars[(frame_type >> 4) as usize]);
        header.push(hex_chars[(frame_type & 0x0f) as usize]);

        let mut frame_data = vec![frame_type];
        frame_data.extend_from_slice(&data);

        for &byte in &frame_data {
            header.push(hex_chars[(byte >> 4) as usize]);
            header.push(hex_chars[(byte & 0x0f) as usize]);
        }

        let crc = Self::crc16(&frame_data);
        let crc_bytes = [(crc >> 8) as u8, (crc & 0xff) as u8];
        for &byte in &crc_bytes {
            header.push(hex_chars[(byte >> 4) as usize]);
            header.push(hex_chars[(byte & 0x0f) as usize]);
        }

        header
    }

    pub fn handle_data(
        &mut self,
        data: &[u8],
        save_path: Option<String>,
    ) -> ZmodemAction {
        if !self.active && Self::is_zmodem_start(data) {
            self.active = true;
            self.receiving = true;
            self.phase = ZmodemPhase::WaitInit;

            if let Some(path) = save_path {
                self.save_path = Some(path);
            }

            if let Some((frame_type, _payload)) = Self::parse_header(data) {
                match frame_type {
                    ZRQINIT => {
                        self.phase = ZmodemPhase::WaitFile;
                        return ZmodemAction::SendData(
                            Self::build_header(ZRINIT, [0x00; 4])
                        );
                    }
                    _ => {}
                }
            }
            return ZmodemAction::SendData(
                Self::build_header(ZRINIT, [0x00; 4])
            );
        }

        if !self.active {
            return ZmodemAction::PassThrough;
        }

        if let Some((frame_type, payload)) = Self::parse_header(data) {
            match frame_type {
                ZRQINIT => {
                    self.phase = ZmodemPhase::WaitFile;
                    return ZmodemAction::SendData(
                        Self::build_header(ZRINIT, [0x00; 4])
                    );
                }
                ZFILE => {
                    self.phase = ZmodemPhase::WaitData;
                    let mut name_start = 0;
                    while name_start < payload.len() && payload[name_start] != 0 {
                        name_start += 1;
                    }
                    self.file_name = String::from_utf8_lossy(&payload[..name_start]).to_string();
                    self.file_size = u64::from_le_bytes([
                        payload.get(name_start + 1).copied().unwrap_or(0),
                        payload.get(name_start + 2).copied().unwrap_or(0),
                        payload.get(name_start + 3).copied().unwrap_or(0),
                        payload.get(name_start + 4).copied().unwrap_or(0),
                        payload.get(name_start + 5).copied().unwrap_or(0),
                        payload.get(name_start + 6).copied().unwrap_or(0),
                        payload.get(name_start + 7).copied().unwrap_or(0),
                        payload.get(name_start + 8).copied().unwrap_or(0),
                    ]);
                    self.expecting_file = true;
                    return ZmodemAction::SendData(
                        Self::build_header(ZRPOS, [0, 0, 0, 0])
                    );
                }
                ZDATA => {
                    self.phase = ZmodemPhase::WaitData;
                    return ZmodemAction::SendData(
                        Self::build_header(ZACK, [0, 0, 0, 0])
                    );
                }
                ZEOF => {
                    self.phase = ZmodemPhase::Done;
                    return ZmodemAction::SendData(
                        Self::build_header(ZRINIT, [0x00; 4])
                    );
                }
                ZFIN => {
                    let response = Self::build_header(ZFIN, [0, 0, 0, 0]);
                    self.reset();
                    return ZmodemAction::Finished(response);
                }
                ZNAK => {
                    return ZmodemAction::SendData(
                        Self::build_header(ZRINIT, [0x00; 4])
                    );
                }
                _ => {
                    return ZmodemAction::SendData(
                        Self::build_header(ZACK, [0, 0, 0, 0])
                    );
                }
            }
        }

        if self.expecting_file && !data.starts_with(&[ZPAD, ZPAD, ZDLE]) {
            self.file_data.extend_from_slice(data);
            return ZmodemAction::FileData(data.to_vec());
        }

        ZmodemAction::None
    }
}

pub enum ZmodemAction {
    None,
    PassThrough,
    SendData(Vec<u8>),
    FileData(Vec<u8>),
    Finished(Vec<u8>),
    NeedSavePath(String),
}
