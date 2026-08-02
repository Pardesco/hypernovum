interface HypernovumDirectoryDialog {
  showOpenDialog(options: {
    properties: Array<'openDirectory' | 'createDirectory'>;
    title: string;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

declare module '@electron/remote' {
  export const dialog: HypernovumDirectoryDialog;
}

declare module 'electron' {
  export const remote: { dialog?: HypernovumDirectoryDialog } | undefined;
}
