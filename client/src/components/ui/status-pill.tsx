import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statusPillVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap",
  {
    variants: {
      variant: {
        idle: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
        processing:
          "border-primary/20 bg-primary/10 text-primary",
        completed:
          "border-[color:var(--success)]/20 bg-[color:var(--success)]/10 text-[color:var(--success)]",
        failed:
          "border-destructive/20 bg-destructive/10 text-destructive",
        warning:
          "border-[color:var(--warning)]/20 bg-[color:var(--warning)]/10 text-[color:var(--warning)]",
      },
    },
    defaultVariants: {
      variant: "idle",
    },
  }
)

function StatusPill({
  className,
  variant = "idle",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof statusPillVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(statusPillVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "status-pill",
      variant,
    },
  })
}

// eslint-disable-next-line react-refresh/only-export-components
export { StatusPill, statusPillVariants }
