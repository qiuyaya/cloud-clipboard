declare module "bcryptjs" {
  export interface HashOptions {
    saltRounds?: number;
  }

  export interface CompareOptions {
    checkKeys?: boolean;
  }

  export function hash(password: string, saltRounds?: number): Promise<string>;
  export function hashSync(password: string, saltRounds?: number): string;
  export function compare(password: string, hash: string): Promise<boolean>;
  export function compareSync(password: string, hash: string): boolean;
  export function genSaltSync(saltRounds?: number): string;
  export function genSalt(saltRounds?: number): Promise<string>;
}
