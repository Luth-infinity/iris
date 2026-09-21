import * as React from 'react'
import { cn } from '@renderer/lib/utils'

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, checked, ...props }, ref) => (
    <span className="relative inline-flex flex-shrink-0 cursor-pointer items-center">
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      <span
        className={cn(
          "h-5 w-9 rounded-full bg-shell-border transition-colors peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-shell-raised after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-4",
          className
        )}
      />
    </span>
  )
)
Switch.displayName = 'Switch'

export { Switch }
