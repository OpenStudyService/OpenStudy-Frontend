import { Dialog } from "radix-ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useId, useRef } from "react";
import { Icon } from "./Icon";
export function Button({
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return <button className={`btn ${variant} ${className}`} {...props} />;
}
export function Badge({ children }: { children: ReactNode }) {
  const s = String(children);
  const tone = /완료|승인|정상|활성|퇴근|판매 중|이용 가능/.test(s)
    ? "good"
    : /실패|취소|환불|고장|불가|높음|반려|제한|비활성/.test(s)
      ? "bad"
      : /진행|대기|신청|근무|중|필요|만료/.test(s)
        ? "warn"
        : "neutral";
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Avatar({ name, size = "" }: { name: string; size?: string }) {
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {name?.slice(0, 1) || "나"}
    </span>
  );
}
export function State({
  title = "불러오고 있어요",
  message,
  action,
  loading = false,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="state" role={loading ? "status" : undefined}>
      {loading ? <span className="spinner" /> : <Icon name="leaf" size={30} />}
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <State
      title="요청을 완료하지 못했어요"
      message={error.message}
      action={retry && <Button onClick={retry}>다시 시도</Button>}
    />
  );
}
export function Panel({
  open,
  onClose,
  title,
  description = "상세 내용을 확인하고 필요한 작업을 진행해 주세요.",
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const headingId = useId();
  const trigger = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="panel-overlay" />
        <Dialog.Content
          className={`panel ${wide ? "wide" : ""}`}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            trigger.current = document.activeElement as HTMLElement | null;
            requestAnimationFrame(() =>
              document.getElementById(headingId)?.focus(),
            );
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => {
              const target = trigger.current?.isConnected
                ? trigger.current
                : document.getElementById("main");
              target?.focus();
            });
          }}
        >
          <header className="panel-head">
            <div>
              <Dialog.Title id={headingId} tabIndex={-1}>
                {title}
              </Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="닫기">
                <Icon name="close" />
              </Button>
            </Dialog.Close>
          </header>
          <div className="panel-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
export function FieldError({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <p id={id} className="form-error" role="alert">
      {children}
    </p>
  );
}
