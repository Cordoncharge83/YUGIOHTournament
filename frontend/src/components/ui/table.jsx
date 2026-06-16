import { cn } from "../../lib/utils";

function Table({ className, containerClassName, ...props }) {
  return (
    <div className={cn("w-full overflow-x-auto", containerClassName)}>
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableRow({ className, ...props }) {
  return <tr className={cn("border-b border-slate-800 transition-colors hover:bg-slate-900/60", className)} {...props} />;
}

function TableHead({ className, ...props }) {
  return <th className={cn("h-10 px-3 text-left align-middle font-medium text-slate-400", className)} {...props} />;
}

function TableCell({ className, ...props }) {
  return <td className={cn("px-3 py-3 align-middle", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
