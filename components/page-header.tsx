export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 md:mb-10">
      <div className="min-w-0">
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.025em]">{title}</h1>
        {description && <div className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">{description}</div>}
      </div>
      {actions}
    </div>
  );
}

/** Friendly empty state: an icon, what's missing, and the one thing to do next. */
export function EmptyState({
  title,
  icon,
  children,
  action,
  flat = false,
}: {
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  flat?: boolean;
}) {
  return (
    <div className={`${flat ? "" : "glass-flat rounded-[24px]"} flex flex-col items-center px-6 py-12 text-center`}>
      {icon && <span className="mb-4 grid size-12 place-items-center rounded-full bg-sheet text-ink-2 shadow-control">{icon}</span>}
      <p className="text-[17px] font-medium">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Primary action: solid ink pill, like Apple's filled buttons. */
export const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-on-primary shadow-control transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100";

/** Secondary action: frosted pill. */
export const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-fill px-5 text-[15px] font-medium text-ink transition-colors duration-150 hover:bg-fill-hover disabled:opacity-40";

/** Quiet text link styled as a small pill (section actions like "All tasks"). */
export const linkButton =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-blue transition-colors duration-150 hover:bg-fill";
