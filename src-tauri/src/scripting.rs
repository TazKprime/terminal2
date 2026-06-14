use std::collections::VecDeque;

pub struct ScriptExecutor {
    steps: Vec<AutomationStep>,
    current_step: usize,
    buffer: VecDeque<u8>,
    buffer_max: usize,
    send_initial_cr: bool,
    initial_cr_sent: bool,
}

#[derive(Debug, Clone)]
pub struct AutomationStep {
    pub expect: String,
    pub send: String,
}

impl ScriptExecutor {
    pub fn new(
        steps: Vec<AutomationStep>,
        send_initial_cr: bool,
        buffer_max: usize,
    ) -> Self {
        Self {
            steps,
            current_step: 0,
            buffer: VecDeque::new(),
            buffer_max,
            send_initial_cr,
            initial_cr_sent: false,
        }
    }

    pub fn should_send_initial_cr(&self) -> bool {
        self.send_initial_cr && !self.initial_cr_sent
    }

    pub fn mark_initial_cr_sent(&mut self) {
        self.initial_cr_sent = true;
    }

    pub fn feed_input(&mut self, data: &[u8]) -> Option<Vec<u8>> {
        for byte in data {
            self.buffer.push_back(*byte);
            if self.buffer.len() > self.buffer_max {
                self.buffer.pop_front();
            }
        }

        self.process_buffer()
    }

    fn process_buffer(&mut self) -> Option<Vec<u8>> {
        if self.current_step >= self.steps.len() {
            return None;
        }

        let step = &self.steps[self.current_step];
        let buffer_str = String::from_utf8_lossy(self.buffer.make_contiguous()).to_string();

        if let Some(pos) = buffer_str.find(&step.expect) {
            let send_bytes = expand_send_string(&step.send);
            let match_end = pos + step.expect.len();
            let drain_count = match_end;
            for _ in 0..drain_count {
                self.buffer.pop_front();
            }
            self.current_step += 1;
            Some(send_bytes)
        } else {
            None
        }
    }

    pub fn is_complete(&self) -> bool {
        self.current_step >= self.steps.len()
    }

    pub fn current_step_index(&self) -> usize {
        self.current_step
    }
}

pub fn expand_send_string(input: &str) -> Vec<u8> {
    let mut result = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            match chars[i + 1] {
                'r' => {
                    result.push(b'\r');
                    i += 2;
                }
                'n' => {
                    result.push(b'\n');
                    i += 2;
                }
                't' => {
                    result.push(b'\t');
                    i += 2;
                }
                '\\' => {
                    result.push(b'\\');
                    i += 2;
                }
                'x' if i + 3 < chars.len() => {
                    let hex_str: String = chars[i + 2..=i + 3].iter().collect();
                    if let Ok(byte) = u8::from_str_radix(&hex_str, 16) {
                        result.push(byte);
                        i += 4;
                    } else {
                        result.push(chars[i] as u8);
                        i += 1;
                    }
                }
                _ => {
                    result.push(chars[i] as u8);
                    i += 1;
                }
            }
        } else if chars[i] == '{' {
            let close_pos = input[i..].find('}').map(|p| i + p + 1);
            if let Some(end) = close_pos {
                let token: String = chars[i + 1..end - 1].iter().collect();
                match token.as_str() {
                    "ENTER" => result.push(b'\r'),
                    "TAB" => result.push(b'\t'),
                    "F1" => {
                        result.extend_from_slice(&[0x1b, b'O', b'P']);
                    }
                    "F2" => {
                        result.extend_from_slice(&[0x1b, b'O', b'Q']);
                    }
                    "F3" => {
                        result.extend_from_slice(&[0x1b, b'O', b'R']);
                    }
                    "F4" => {
                        result.extend_from_slice(&[0x1b, b'O', b'S']);
                    }
                    "F5" => {
                        result.extend_from_slice(&[0x1b, b'[', b'1', b'5', b'~']);
                    }
                    "F6" => {
                        result.extend_from_slice(&[0x1b, b'[', b'1', b'7', b'~']);
                    }
                    "F7" => {
                        result.extend_from_slice(&[0x1b, b'[', b'1', b'8', b'~']);
                    }
                    "F8" => {
                        result.extend_from_slice(&[0x1b, b'[', b'1', b'9', b'~']);
                    }
                    "F9" => {
                        result.extend_from_slice(&[0x1b, b'[', b'2', b'0', b'~']);
                    }
                    "F10" => {
                        result.extend_from_slice(&[0x1b, b'[', b'2', b'1', b'~']);
                    }
                    "F11" => {
                        result.extend_from_slice(&[0x1b, b'[', b'2', b'3', b'~']);
                    }
                    "F12" => {
                        result.extend_from_slice(&[0x1b, b'[', b'2', b'4', b'~']);
                    }
                    _ => {
                        for c in token.chars() {
                            result.push(c as u8);
                        }
                    }
                }
                i = end;
            } else {
                result.push(chars[i] as u8);
                i += 1;
            }
        } else {
            result.push(chars[i] as u8);
            i += 1;
        }
    }

    result
}
