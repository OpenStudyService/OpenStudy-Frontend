import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { Badge, Button, ErrorState, State } from "../../shared/ui/primitives";
import { Field, SaveError } from "../organization/shared";
import { fieldLabels, loadCategory, useCategories } from "./hooks";
import { kinds } from "./model";
import type { Kind, ProductCategory } from "./model";

/** Everyone may read categories; only the owner changes them (code and kind never change). */
export function CategoryManagement() {
  const { session, scope } = useApp();
  const context = JSON.stringify([
    session.user.id,
    scope,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  return <CategoryManagementSession key={context} />;
}
function CategoryManagementSession() {
  const { session } = useApp();
  const query = useQueryClient();
  const key = useIdempotency();
  const categories = useCategories();
  const owner = session.user.owner;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("시간권");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<ProductCategory | null>(null);
  async function refresh() {
    await query.invalidateQueries({ queryKey: ["data", session.user.id] });
  }
  async function guard(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-4">
      <p className="help">
        분류 코드와 유형은 등록한 뒤에는 바꿀 수 없어요. 분류를 쓰지 않으려면
        사용 중지로 바꿔 주세요. 이미 지정된 상품은 그대로 유지돼요.
      </p>
      {owner && (
        <form
          className="card grid gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void guard(async () => {
              const body = { code: code.trim(), name: name.trim(), kind };
              await api<ProductCategory>("/product-categories", {
                method: "POST",
                body,
                key: key.key("create", body),
              });
              key.committed();
              setCode("");
              setName("");
            });
          }}
        >
          <h3>분류 등록</h3>
          <Field label="분류 코드 (영문 대문자·숫자·밑줄)">
            <input
              required
              maxLength={40}
              pattern="[A-Z][A-Z0-9_]{0,39}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="분류 이름">
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="분류 유형">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={busy}>
            분류 등록
          </Button>
        </form>
      )}
      {categories.isPending ? (
        <State loading />
      ) : categories.error ? (
        <ErrorState
          error={categories.error}
          retry={() => void categories.refetch()}
        />
      ) : (
        <>
          {!categories.data.items.length && (
            <State title="등록된 분류가 없어요" />
          )}
          {categories.data.items.map((category) => (
            <article className="card p-4" key={category.id}>
              <h3>{category.name}</h3>
              <p className="help">
                {category.code} · {category.kind}
              </p>
              <Badge>{category.status}</Badge>
              {owner && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setEdit(category);
                      setError(null);
                    }}
                  >
                    분류 수정: {category.name}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        await api<ProductCategory>(
                          `/product-categories/${category.id}`,
                          {
                            method: "PATCH",
                            body: {
                              version: category.version,
                              status:
                                category.status === "활성" ? "비활성" : "활성",
                            },
                          },
                        );
                      })
                    }
                  >
                    {category.status === "활성"
                      ? `사용 중지: ${category.name}`
                      : `다시 사용: ${category.name}`}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </>
      )}
      {edit && (
        <CategoryNameEditor
          key={edit.id}
          category={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void refresh();
          }}
        />
      )}
      <SaveError error={error} refresh={refresh} fieldLabels={fieldLabels} />
    </section>
  );
}

function CategoryNameEditor({
  category,
  onClose,
  onSaved,
}: {
  category: ProductCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category.name),
    [error, setError] = useState<Error | null>(null),
    [reloadError, setReloadError] = useState<Error | null>(null),
    [latest, setLatest] = useState<ProductCategory | null>(null),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    lock = useRef(false);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  async function request(
    task: (signal: AbortSignal) => Promise<void>,
    failed: (error: Error) => void,
  ) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await task(signal);
    } catch (e) {
      if (!signal.aborted) failed(e as Error);
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  async function reload() {
    await request(async (signal) => {
      setLatest(null);
      setReloadError(null);
      const current = await loadCategory(category, signal);
      signal.throwIfAborted();
      setLatest(current);
    }, setReloadError);
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (conflict && !latest) return;
    void request(
      async (signal) => {
        setError(null);
        await api<ProductCategory>(`/product-categories/${category.id}`, {
          method: "PATCH",
          body: {
            version: latest?.version ?? category.version,
            name: name.trim(),
          },
          signal,
        });
        signal.throwIfAborted();
        onSaved();
      },
      (failure) => {
        setError(failure);
        if (failure instanceof ApiError && failure.status === 409) {
          setConflict(true);
          setLatest(null);
          setReloadError(null);
        }
      },
    );
  }
  return (
    <form
      aria-label="분류 이름 편집"
      className="card grid gap-3 p-4"
      onSubmit={save}
    >
      <h3>{category.code} 이름 변경</h3>
      <Field label="분류 이름 변경">
        <input
          required
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <SaveError
        error={error}
        refresh={reload}
        latest={
          latest
            ? `${latest.name} / ${latest.status} (v${latest.version})`
            : undefined
        }
        fieldLabels={{ ...fieldLabels, name: "분류 이름" }}
      />
      {reloadError && (
        <ErrorState error={reloadError} retry={() => void reload()} />
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || (conflict && !latest)}>
          {busy ? "처리 중…" : latest ? "최신 기준으로 이름 저장" : "이름 저장"}
        </Button>
        <Button type="button" disabled={busy} onClick={onClose}>
          취소
        </Button>
      </div>
    </form>
  );
}
