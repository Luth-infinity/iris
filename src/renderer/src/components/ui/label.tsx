import * as React from 'react'
import { cn } from '@renderer/lib/utils'

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-xs font-medium text-shell-muted', className)} {...props} />
  )
)
Label.displayName = 'Label'

export { Label }
