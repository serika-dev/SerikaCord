// Isomorphic E2EE core (WebCrypto only; runs in browsers, WebViews and Bun).
// Protocol: docs/architecture/e2ee.md. Client key storage and UI glue live in
// ./client; server routes in src/lib/api/e2ee.ts.
export * from "./constants";
export {
  E2eeFormatError,
  E2eeVerifyError,
  fromB64,
  isBase64,
  toB64,
  type Bytes,
} from "./encoding";
export * from "./keys";
export * from "./payload";
export * from "./envelope";
export * from "./attachments";
export * from "./backup";
export * from "./safetyNumber";
export * from "./dtls";
export * from "./franking";
export * from "./conversation";
export * from "./passphrase";
