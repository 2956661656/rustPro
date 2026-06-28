// LSP protocol types for call hierarchy operations
// Based on LSP 3.16 spec + rust-analyzer extensions

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface TextDocumentItem {
  uri: string
  languageId: string
  version: number
  text: string
}

export interface CallHierarchyItem {
  name: string
  kind: SymbolKind
  tags?: SymbolTag[]
  detail?: string
  uri: string
  range: Range
  selectionRange: Range
  data?: unknown
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export enum SymbolTag {
  Deprecated = 1,
}

export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem
  fromRanges: Range[]
}

export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem
  fromRanges: Range[]
}

export interface DocumentSymbolParams {
  textDocument: {
    uri: string
  }
}

export interface CallHierarchyPrepareParams {
  textDocument: {
    uri: string
  }
  position: Position
}

export interface CallHierarchyIncomingCallsParams {
  item: CallHierarchyItem
}

export interface CallHierarchyOutgoingCallsParams {
  item: CallHierarchyItem
}

export interface InitializeParams {
  processId: number | null
  clientInfo?: {
    name: string
    version?: string
  }
  capabilities: {
    textDocument?: {
      callHierarchy?: {
        dynamicRegistration?: boolean
      }
      documentSymbol?: {
        dynamicRegistration?: boolean
        hierarchicalDocumentSymbolSupport?: boolean
        symbolKind?: {
          valueSet?: number[]
        }
      }
      hover?: {
        dynamicRegistration?: boolean
        contentFormat?: string[]
      }
    }
  }
  initializationOptions?: Record<string, unknown>
}

export interface InitializeResult {
  capabilities: {
    callHierarchyProvider?: boolean
    documentSymbolProvider?: boolean
    [key: string]: unknown
  }
  serverInfo?: {
    name: string
    version?: string
  }
}

// LSP message envelope
export interface LSPMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// ─── Hover types ───────────────────────────────────────────────

export type MarkupKind = 'plaintext' | 'markdown'

export interface MarkupContent {
  kind: MarkupKind
  value: string
}

export type MarkedString = string | { language: string; value: string }

export interface Hover {
  contents: MarkupContent | MarkedString | MarkedString[]
  range?: Range
}

export interface HoverParams {
  textDocument: {
    uri: string
  }
  position: Position
}
