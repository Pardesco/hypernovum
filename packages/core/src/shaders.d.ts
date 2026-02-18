// Allow importing GLSL shader files as text (handled by esbuild loader)
declare module '*.vert' {
  const value: string;
  export default value;
}

declare module '*.frag' {
  const value: string;
  export default value;
}
