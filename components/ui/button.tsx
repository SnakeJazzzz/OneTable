import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'destructive';

const variantClasses: Record<Variant, string> = {
  default:
    'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive',
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
