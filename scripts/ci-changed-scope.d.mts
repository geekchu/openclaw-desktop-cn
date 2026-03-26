export declare function detectChangedScope(paths: string[]): {
  runNode: boolean;
  runMacos: boolean;
  runAndroid: boolean;
  runWindows: boolean;
  runSkillsPython: boolean;
};
export declare function listChangedPaths(base: string, head?: string): string[];
