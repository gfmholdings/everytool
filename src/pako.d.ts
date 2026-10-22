declare module 'pako' {
  interface Pako {
    inflate(data: Uint8Array): Uint8Array;
  }
  const pako: Pako;
  export default pako;
}
