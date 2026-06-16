import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-sky-400/35 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25",
        secondary: "border border-slate-600/60 bg-slate-800/80 text-slate-100 hover:bg-slate-700/80",
        outline: "border border-slate-600/70 bg-slate-950/30 text-slate-200 hover:bg-slate-800/70",
        ghost: "text-slate-300 hover:bg-slate-800/70 hover:text-slate-50",
        destructive: "border border-rose-400/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
