import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    /** Custom command identifier consumed by the command system */
    command?: string;
    /** Custom command target identifier consumed by the command system */
    commandfor?: string;
  }
}
