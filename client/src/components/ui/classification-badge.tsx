import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

function ClassificationBadge({
  className,
  render,
  ...props
}: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          "inline-flex h-5 w-fit shrink-0 items-center rounded-sm border border-secondary/30 bg-transparent px-1.5 text-[10px] font-semibold uppercase tracking-wider text-secondary",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "classification-badge",
    },
  })
}

export { ClassificationBadge }
