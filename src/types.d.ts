// Declarações de módulos sem tipos nativos
declare module 'node-cron' {
  export function schedule(
    expression: string,
    func: () => void,
    options?: { timezone?: string; scheduled?: boolean }
  ): { start: () => void; stop: () => void };
  export function validate(expression: string): boolean;
}
