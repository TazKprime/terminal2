export interface GlobalConfig {
  defaultTheme: string;
  defaultFont: FontConfig;
  lastSession: string | null;
  recentSessions: string[];
  quickConnectDefaults: QuickConnectDefaults;
  loggingDefaults: LoggingDefaults;
}

export interface FontConfig {
  family: string;
  size: number;
}

export interface QuickConnectDefaults {
  protocol: string;
  terminalType: string;
}

export interface LoggingDefaults {
  enabled: boolean;
  mode: string;
  path: string;
}

export interface SessionProfile {
  id: string;
  name: string;
  folder: string;
  protocol: string;
  connection: ConnectionConfig;
  terminal: TerminalConfig;
  appearance: AppearanceConfig;
  logging: LoggingConfig;
  logonAutomation: LogonAutomation;
}

export interface ConnectionConfig {
  hostname: string;
  port: number;
  username: string;
  authMethod: string;
  privateKeyPath: string;
  passwordSaved: boolean;
  tlsVerify: boolean;
  comPort: string;
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
  flowControl: string;
}

export interface TerminalConfig {
  terminalType: string;
  encoding: string;
  scrollbackLines: number;
  wrapLines: boolean;
  localEcho: boolean;
  newlineConvention: string;
}

export interface AppearanceConfig {
  theme: string;
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  cursorStyle: string;
  cursorBlink: boolean;
  colorOverrides: ColorOverrides;
}

export interface ColorOverrides {
  background?: string;
  foreground?: string;
}

export interface LoggingConfig {
  enabled: boolean;
  mode: string;
  path: string;
  append: boolean;
}

export interface LogonAutomation {
  enabled: boolean;
  sendInitialCarriageReturn: boolean;
  steps: AutomationStep[];
}

export interface AutomationStep {
  expect: string;
  send: string;
}

export interface FolderTree {
  folders: FolderEntry[];
}

export interface FolderEntry {
  path: string;
  sessions: string[];
}

export interface ThemeProfile {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  ansiColors: AnsiColors;
}

export interface AnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export type ConnectionStatus = "connecting" | "connected" | "auth-failed" | "closed" | "error";

export interface TabSession {
  id: string;
  name: string;
  status: ConnectionStatus;
  profile: SessionProfile;
}

export const DEFAULT_SESSION: SessionProfile = {
  id: "",
  name: "New Session",
  folder: "",
  protocol: "ssh2",
  connection: {
    hostname: "",
    port: 22,
    username: "",
    authMethod: "password",
    privateKeyPath: "",
    passwordSaved: false,
    tlsVerify: true,
    comPort: "COM3",
    baudRate: 9600,
    dataBits: 8,
    parity: "none",
    stopBits: 1,
    flowControl: "none",
  },
  terminal: {
    terminalType: "xterm-256color",
    encoding: "utf-8",
    scrollbackLines: 5000,
    wrapLines: true,
    localEcho: false,
    newlineConvention: "crlf",
  },
  appearance: {
    theme: "dark",
    fontFamily: "Cascadia Mono",
    fontSize: 12,
    lineSpacing: 1.1,
    cursorStyle: "block",
    cursorBlink: true,
    colorOverrides: {},
  },
  logging: {
    enabled: false,
    mode: "plaintext",
    path: "logs/{session}_{date}_{time}.log",
    append: true,
  },
  logonAutomation: {
    enabled: false,
    sendInitialCarriageReturn: false,
    steps: [],
  },
};

export const PROTOCOLS = ["ssh2", "telnet", "telnet-ssl", "rlogin", "serial", "simulation"] as const;
