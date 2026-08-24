import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

type ClassValue = string | false | null | undefined;

/** UIプリミティブで共通利用するクラス名結合ヘルパーです。 */
export function cn(...values: ClassValue[]) {
  return values.filter(Boolean).join(' ');
}

const uiStyles = `
  .app-shell[data-slot='app-shell'] {
    --background: #f4f7f8;
    --foreground: #18252b;
    --card: #ffffff;
    --card-foreground: #18252b;
    --popover: #ffffff;
    --popover-foreground: #18252b;
    --primary: #176b62;
    --primary-foreground: #f4fffc;
    --secondary: #e7f0ef;
    --secondary-foreground: #164e49;
    --muted: #edf2f3;
    --muted-foreground: #607178;
    --accent: #dff3ed;
    --accent-foreground: #15584e;
    --destructive: #c2414e;
    --destructive-foreground: #fff8f8;
    --border: #d9e3e5;
    --input: #d4e0e2;
    --ring: #43a99b;
    --radius: 0.85rem;
    --shadow-sm: 0 1px 2px rgb(24 37 43 / 0.05);
    --shadow-md: 0 10px 30px rgb(24 37 43 / 0.08);
  }

  .app-shell--content-only[data-slot='app-shell'] {
    display: block;
  }

  .app-shell--content-only[data-slot='app-shell'] .app-main {
    min-height: 100dvh;
  }

  .app-shell--content-only[data-slot='app-shell'] .app-content {
    width: min(100%, 72rem);
    margin: 0 auto;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px solid transparent;
    border-radius: calc(var(--radius) - 0.2rem);
    min-height: 2.5rem;
    padding: 0.625rem 1rem;
    color: var(--primary-foreground);
    background: var(--primary);
    box-shadow: var(--shadow-sm);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button']:hover:not(:disabled) {
    background: #12584f;
    box-shadow: 0 4px 12px rgb(23 107 98 / 0.2);
    transform: translateY(-1px);
  }

  .app-shell[data-slot='app-shell'] [data-slot='button']:active:not(:disabled) {
    transform: translateY(0);
  }

  .app-shell[data-slot='app-shell'] [data-slot='button']:focus-visible,
  .app-shell[data-slot='app-shell'] [data-slot='badge']:focus-visible {
    outline: 3px solid rgb(67 169 155 / 0.35);
    outline-offset: 2px;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button']:disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='secondary'] {
    color: var(--secondary-foreground);
    background: var(--secondary);
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='secondary']:hover:not(:disabled) {
    background: #d8e9e6;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='outline'] {
    color: var(--foreground);
    border-color: var(--border);
    background: var(--card);
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='outline']:hover:not(:disabled) {
    border-color: var(--ring);
    background: var(--accent);
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='ghost'] {
    color: var(--foreground);
    background: transparent;
    box-shadow: none;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='ghost']:hover:not(:disabled) {
    background: var(--muted);
    box-shadow: none;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='destructive'] {
    background: var(--destructive);
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='destructive']:hover:not(:disabled) {
    background: #a93440;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='link'] {
    min-height: auto;
    padding: 0;
    color: var(--primary);
    background: transparent;
    box-shadow: none;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-variant='link']:hover:not(:disabled) {
    color: #0f514a;
    background: transparent;
    box-shadow: none;
    text-decoration: underline;
    transform: none;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-size='sm'] {
    min-height: 2.125rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-size='lg'] {
    min-height: 2.875rem;
    padding: 0.75rem 1.25rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='button'][data-size='icon'] {
    width: 2.5rem;
    padding: 0;
  }

  .app-shell[data-slot='app-shell'] [data-slot='card'] {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--card-foreground);
    background: var(--card);
    box-shadow: var(--shadow-sm);
  }

  .app-shell[data-slot='app-shell'] [data-slot='card-header'] {
    display: grid;
    gap: 0.375rem;
    padding: 1.25rem 1.25rem 0;
  }

  .app-shell[data-slot='app-shell'] [data-slot='card-title'] {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  .app-shell[data-slot='app-shell'] [data-slot='card-description'] {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='card-content'] {
    padding: 1.25rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='card-header'] + [data-slot='card-content'] {
    padding-top: 1rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='card-footer'] {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1.25rem 1.25rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='badge'] {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    min-height: 1.5rem;
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 0.25rem 0.625rem;
    color: var(--primary-foreground);
    background: var(--primary);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .app-shell[data-slot='app-shell'] [data-slot='badge'][data-variant='secondary'] {
    color: var(--secondary-foreground);
    background: var(--secondary);
  }

  .app-shell[data-slot='app-shell'] [data-slot='badge'][data-variant='outline'] {
    color: var(--foreground);
    border-color: var(--border);
    background: transparent;
  }

  .app-shell[data-slot='app-shell'] [data-slot='badge'][data-variant='destructive'] {
    color: var(--destructive-foreground);
    background: var(--destructive);
  }

  .app-shell[data-slot='app-shell'] [data-slot='badge'][data-variant='success'] {
    color: #14543f;
    background: #d9f2e5;
  }

  .app-shell[data-slot='app-shell'] [data-slot='section'] {
    display: grid;
    gap: 1rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='section-header'] {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='section-heading'] {
    display: grid;
    gap: 0.25rem;
  }

  .app-shell[data-slot='app-shell'] [data-slot='section-eyebrow'] {
    margin: 0;
    color: var(--primary);
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    line-height: 1.2;
    text-transform: uppercase;
  }

  .app-shell[data-slot='app-shell'] [data-slot='section-title'] {
    margin: 0;
    color: var(--foreground);
    font-size: clamp(1.25rem, 2vw, 1.6rem);
    font-weight: 750;
    letter-spacing: -0.035em;
    line-height: 1.2;
  }

  .app-shell[data-slot='app-shell'] [data-slot='section-description'] {
    max-width: 48rem;
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.9375rem;
  }

  @media (max-width: 768px) {
    .app-shell[data-slot='app-shell'] [data-slot='section-header'] {
      align-items: stretch;
      flex-direction: column;
    }

    .app-shell[data-slot='app-shell'] [data-slot='section-actions'] {
      width: 100%;
    }

    .app-shell[data-slot='app-shell'] [data-slot='section-actions'] > [data-slot='button'] {
      width: 100%;
    }

    .app-shell[data-slot='app-shell'] [data-slot='card-header'],
    .app-shell[data-slot='app-shell'] [data-slot='card-content'] {
      padding-right: 1rem;
      padding-left: 1rem;
    }

    .app-shell[data-slot='app-shell'] [data-slot='card-footer'] {
      align-items: stretch;
      flex-direction: column;
      padding-right: 1rem;
      padding-left: 1rem;
    }

    .app-shell[data-slot='app-shell'] [data-slot='card-footer'] > [data-slot='button'] {
      width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .app-shell[data-slot='app-shell'] [data-slot='button'] {
      transition: none;
    }
  }
`;

export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      type = 'button',
      variant = 'default',
      size = 'default',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(className)}
        {...props}
      />
    );
  },
);

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return <div data-slot="card" className={cn(className)} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn(className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 data-slot="card-title" className={cn(className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p data-slot="card-description" className={cn(className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-footer" className={cn(className)} {...props} />;
}

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(className)}
      {...props}
    />
  );
}

export interface SectionProps
  extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function Section({
  actions,
  children,
  className,
  description,
  eyebrow,
  title,
  ...props
}: SectionProps) {
  const hasHeader = eyebrow || title || description || actions;

  return (
    <section data-slot="section" className={cn(className)} {...props}>
      {hasHeader ? (
        <header data-slot="section-header">
          <div data-slot="section-heading">
            {eyebrow ? <p data-slot="section-eyebrow">{eyebrow}</p> : null}
            {title ? <h2 data-slot="section-title">{title}</h2> : null}
            {description ? (
              <p data-slot="section-description">{description}</p>
            ) : null}
          </div>
          {actions ? <div data-slot="section-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface AppShellProps {
  children: ReactNode;
  className?: string;
  brand?: ReactNode;
  nav?: ReactNode;
  sidebar?: ReactNode;
  topbar?: ReactNode;
}

const defaultNavigation = [
  { href: '#events-heading', label: '予定と出欠' },
  { href: '#member-list-heading', label: '部員管理' },
  { href: '#ride-operations-heading', label: '送迎' },
  { href: '#bulletin-list-heading', label: '回覧板' },
  { href: '/manual', label: '操作マニュアル' },
] as const;

/** 共通クラス名を持つPC・モバイル対応のアプリケーションシェルです。 */
export function AppShell({
  brand,
  children,
  className,
  nav,
  sidebar,
  topbar,
}: AppShellProps) {
  const brandContent = brand ?? (
    <>
      <span className="app-brand-mark" aria-hidden="true">
        C
      </span>
      <span>CoCoLo</span>
    </>
  );
  const sidebarContent =
    sidebar !== undefined
      ? sidebar
      : nav !== undefined
        ? nav
        : defaultNavigation.map(({ href, label }) => (
            <a key={href} href={href}>
              {label}
            </a>
          ));
  const hasSidebar = sidebarContent !== null;

  return (
    <main
      data-slot="app-shell"
      className={cn(
        'app-shell',
        !hasSidebar && 'app-shell--content-only',
        className,
      )}
    >
      <style data-cocolo-ui="tokens-and-primitives">{uiStyles}</style>
      {hasSidebar ? (
        <aside className="app-sidebar" data-slot="app-sidebar">
          <a className="app-brand" data-slot="app-brand" href="/">
            {brandContent}
          </a>
          <nav
            className="app-nav"
            data-slot="app-nav"
            aria-label="メインメニュー"
          >
            {sidebarContent}
          </nav>
        </aside>
      ) : null}
      <div className="app-main" data-slot="app-main">
        {topbar ? (
          <header className="app-topbar" data-slot="app-topbar">
            {topbar}
          </header>
        ) : null}
        <div className="app-content" data-slot="app-content">
          {children}
        </div>
      </div>
    </main>
  );
}
