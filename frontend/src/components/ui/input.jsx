import { cn } from "../../lib/utils";

function Input({ className, type, ...props }) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/35 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export { Input };
