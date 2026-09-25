declare module 'pdfmake/build/pdfmake' {
  const pdfMake: {
    createPdf(definition: object, layouts?: unknown, fonts?: object, vfs?: object): {
      getBuffer(callback: (buffer: Uint8Array) => void): void;
    };
  };
  export default pdfMake;
}
