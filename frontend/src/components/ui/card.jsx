import { cn } from "../../lib/utils";

function Card({ className, ...props }) {
  return (
    <div
      className={cn("rounded-lg border border-slate-700/70 bg-slate-950/80 text-slate-100 shadow-sm", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return <h3 className={cn("text-lg font-semibold leading-none tracking-normal text-slate-50", className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return <p className={cn("text-sm text-slate-400", className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return <div className={cn("flex items-center p-5 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
