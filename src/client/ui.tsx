import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { fmtYen } from "../shared/mahjong";
import type { Member } from "../shared/types";

export function Yen({ v, big }: { v: number; big?: boolean }) {
  const cls = v > 0 ? "plus" : v < 0 ? "minus" : "zero";
  return <span className={`num ${cls} ${big ? "big" : ""}`}>{fmtYen(v)}</span>;
}

export function Dot({ m }: { m?: Member | null }) {
  return <span className="dot" style={{ background: m?.color ?? "#999" }} aria-hidden />;
}

export function Name({ m }: { m?: Member | null }) {
  return (
    <span className="name">
      <Dot m={m} />
      {m?.name ?? "(不明)"}
    </span>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet-inner">
          <header className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </header>
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export type ConfirmSpec = {
  title: string;
  body: ReactNode;
  okLabel: string;
  danger?: boolean;
  onOk: () => void | Promise<void>;
};

export function Confirm({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  return (
    <Sheet
      open={!!spec}
      onClose={onClose}
      title={spec?.title ?? ""}
      footer={
        spec && (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              やめる
            </button>
            <button
              type="button"
              className={`btn ${spec.danger ? "danger" : "primary"}`}
              onClick={async () => {
                const s = spec;
                onClose();
                await s.onOk();
              }}
            >
              {spec.okLabel}
            </button>
          </>
        )
      }
    >
      {spec?.body}
      <p className="note">この操作は変更履歴に残り、グループの全員が見られます。</p>
    </Sheet>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function today(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）`;
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const RETRY_WAIT_MS = [1000, 3000, 8000];

/** 読み込みに失敗したら間隔を空けて取り直す画像。URLの期限切れに備えて、失敗時に onFail で状態を取り直す */
export function RetryImg({ src, alt = "", onFail, ...rest }: { src: string; alt?: string; onFail?: () => void } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "onError">) {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setAttempt(0);
    return () => window.clearTimeout(timer.current);
  }, [src]);
  if (attempt > RETRY_WAIT_MS.length) {
    return (
      <span className="img-failed" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setAttempt(0); }}>
        読み込めません
        <br />
        押して再試行
      </span>
    );
  }
  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}r=${attempt}`;
  return (
    <img
      {...rest}
      src={url}
      alt={alt}
      onError={() => {
        if (attempt === 0) onFail?.();
        timer.current = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_WAIT_MS[attempt] ?? 0);
      }}
    />
  );
}

/** Blob を画面に出すためのURL。使い終わったら解放する */
export function BlobImg({ blob, alt = "", ...rest }: { blob: Blob; alt?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img {...rest} src={url} alt={alt} /> : null;
}
