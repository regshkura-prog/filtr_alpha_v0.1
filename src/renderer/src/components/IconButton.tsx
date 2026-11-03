import type { ButtonHTMLAttributes, ReactNode } from 'react'

type IconButtonProps = {
  label: string
  children: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg'
  variant?: 'ghost' | 'solid' | 'plain'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

export function IconButton({
  label,
  children,
  size = 'md',
  variant = 'ghost',
  className = '',
  type = 'button',
  ...props
}: IconButtonProps): React.JSX.Element {
  const dimension =
    size === 'lg' ? 'size-16' : size === 'sm' ? 'size-8' : size === 'xs' ? 'size-6' : 'size-11'
  const tone =
    variant === 'solid'
      ? 'bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600'
      : variant === 'plain'
        ? 'bg-transparent text-current hover:bg-white/10 disabled:opacity-30'
        : 'bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:bg-transparent disabled:text-zinc-700'

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`grid ${dimension} shrink-0 place-items-center rounded-full transition duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${tone} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
