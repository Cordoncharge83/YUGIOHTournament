import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-sky-400/35 bg-sky-500/15 text-sky-100",
        secondary: "border-slate-600/60 bg-slate-800/80 text-slate-200",
        outline: "border-slate-600/70 text-slate-300",
        destructive: "border-rose-400/35 bg-rose-500/10 text-rose-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
