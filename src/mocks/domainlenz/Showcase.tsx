import { scenarios, showcase } from "./catalog";
export function Showcase({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="dl-showcase-grid">
      {showcase.map((item) => (
        <button
          type="button"
          key={item.id}
          onClick={() =>
            onPick(scenarios.find((s) => s.id === item.id)!.prompt)
          }
        >
          <span className={`dl-showcase-icon ${item.tone}`}>{item.icon}</span>
          <span>
            <b>{item.label}</b>
            <small>{item.description}</small>
          </span>
          <i>↗</i>
        </button>
      ))}
    </div>
  );
}
