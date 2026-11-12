interface Window {
  admInit(active: string): Promise<object | null>;
  initConsole(active: string): Promise<object | null>;
}
