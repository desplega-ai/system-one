import type { Answer, Question } from "@system-one/ai";

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Shows one answer: a meter for a boolean, one bar per option or level for a choice or a score. */
export function ProbabilityBars({ title, question, answer }: { title: string; question?: Question; answer: Answer | undefined }) {
  return (
    <div className="bars">
      <div className="bars-title">{title}</div>
      {answer === undefined ? (
        <div className="muted">waiting</div>
      ) : answer.type === "refusal" ? (
        <div className="refused">refused{answer.reason ? `: ${answer.reason}` : ""}</div>
      ) : answer.type === "boolean" ? (
        <Bar label="yes" p={answer.probability} best={answer.probability >= 0.5} />
      ) : answer.type === "choice" ? (
        Object.entries(answer.probabilities).map(([option, p]) => <Bar key={option} label={option} p={p} best={option === answer.choice} />)
      ) : (
        answer.probabilities.map((p, i) => {
          const label = question?.type === "score" ? (question.levels[i] ?? String(i)) : String(i);
          return <Bar key={label} label={label} p={p} best={label === answer.level} />;
        })
      )}
    </div>
  );
}

function Bar({ label, p, best }: { label: string; p: number; best: boolean }) {
  return (
    <div className={best ? "bar best" : "bar"}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: pct(p) }} />
      </span>
      <span className="bar-value">{pct(p)}</span>
    </div>
  );
}
