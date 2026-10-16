// The Acme app in a phone frame. Every button and form calls a tool, the same way an agent would,
// so a person can play the AI on /acme. In the voice game the frame is inert, so nobody can click.
// The data attributes let tests read the screen.
import { type FormEvent, useState } from "react";
import { type AppState, matchingFaq, matchingOrders, moods, orderStatus, photoCounts, strings } from "./app.ts";

export type Call = (name: string, input?: Record<string, unknown>) => void;

export function Phone({ app, call }: { app: AppState; call: Call }) {
  const t = strings[app.lang];
  return (
    <div className={`phone theme-${app.mood}`} data-screen={app.screen} data-lang={app.lang} data-theme={app.mood}>
      <div className="phone-bar">
        {app.history.length > 0 && (
          <button type="button" className="tap phone-back" onClick={() => call("go_back")} aria-label="Back">
            ‹
          </button>
        )}
        <button type="button" className="tap" onClick={() => app.screen !== "home" && call("go_to", { screen: "home" })}>
          <strong>{t.appTitle}</strong>
        </button>
        <span className="phone-title">{app.screen === "order" ? `${t.screens.order} #${app.order}` : t.screens[app.screen]}</span>
      </div>
      <div className="phone-screen">
        <ScreenBody app={app} call={call} />
      </div>
      {app.mood === "confused" && <div className="phone-hints">{t.hints}</div>}
    </div>
  );
}

/** A one-field form that calls a text tool. */
function TextTool({ placeholder, go, onSubmit }: { placeholder: string; go: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue("");
  };
  return (
    <form className="phone-form" onSubmit={submit}>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button type="submit">{go}</button>
    </form>
  );
}

function ScreenBody({ app, call }: { app: AppState; call: Call }) {
  const t = strings[app.lang];
  switch (app.screen) {
    case "home":
      return (
        <>
          <h4>{t.welcome}</h4>
          <div className="tiles">
            {(["orders", "photos", "settings", "help"] as const).map((s) => (
              <button type="button" className="tile tap" key={s} onClick={() => call("go_to", { screen: s })}>
                {t.screens[s]}
              </button>
            ))}
          </div>
        </>
      );
    case "orders":
      return (
        <>
          <TextTool placeholder={t.inputs.searchOrders} go={t.inputs.go} onSubmit={(query) => call("search_orders", { query })} />
          {app.orderQuery && <p className="phone-note">{t.results(app.orderQuery, matchingOrders(app).length)}</p>}
          <ul className="phone-list">
            {matchingOrders(app).map((id) => (
              <li key={id}>
                <button type="button" className="tap row" onClick={() => call("open_order", { order: id })}>
                  #{id} {t.products[id]}
                  <small>{t.orderStatus[orderStatus(app, id)]}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      );
    case "order": {
      const status = orderStatus(app, app.order);
      return (
        <>
          <h4>
            #{app.order} {t.products[app.order]}
          </h4>
          <p>{status === "cancelled" ? t.cancelledNote : t.orderStatus[status]}</p>
          {app.tracking && status !== "cancelled" && <p className="phone-note">{t.tracking}</p>}
          {status !== "cancelled" && (
            <>
              <button type="button" className="phone-button" onClick={() => call("track_order")}>
                {t.buttons.track}
              </button>
              <button type="button" className="phone-button primary" onClick={() => call("cancel_order")}>
                {t.buttons.cancel}
              </button>
            </>
          )}
          <button type="button" className="phone-button" onClick={() => call("contact_support")}>
            {t.buttons.contact}
          </button>
        </>
      );
    }
    case "photos":
      return (
        <ul className="phone-list">
          {(["summer", "family"] as const).map((id) => (
            <li key={id}>
              <button type="button" className="tap row" onClick={() => call("open_album", { album: id })}>
                {app.albumNames[id] ?? t.albums[id]}
                <small>{t.photoCount(photoCounts[id])}</small>
              </button>
            </li>
          ))}
        </ul>
      );
    case "album":
      return (
        <>
          <h4>{app.albumNames[app.album] ?? t.albums[app.album]}</h4>
          <TextTool placeholder={t.inputs.rename} go={t.inputs.go} onSubmit={(name) => call("rename_album", { name })} />
          <div className="album">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} style={{ background: `hsl(${(i * 37 + (app.album === "family" ? 180 : 0)) % 360} 60% 70%)` }} />
            ))}
          </div>
        </>
      );
    case "settings":
      return (
        <ul className="phone-list">
          <li>
            <button type="button" className="tap row" onClick={() => call("set_language", { language: app.lang === "en" ? "es" : "en" })}>
              {t.settings.language}
              <small>{t.languageNames[app.lang]}</small>
            </button>
          </li>
          <li>
            <button type="button" className="tap row" onClick={() => call("set_notifications", { state: app.notifications ? "off" : "on" })}>
              {t.settings.notifications}
              <small>{app.notifications ? t.settings.on : t.settings.off}</small>
            </button>
          </li>
          <li>
            <button type="button" className="tap row" onClick={() => call("set_theme", { mood: moods[(moods.indexOf(app.mood) + 1) % moods.length] })}>
              {t.settings.theme}
              <small>{t.moodNames[app.mood]}</small>
            </button>
          </li>
        </ul>
      );
    case "help":
      return (
        <>
          <TextTool placeholder={t.inputs.searchHelp} go={t.inputs.go} onSubmit={(query) => call("search_help", { query })} />
          {app.helpQuery && <p className="phone-note">{t.results(app.helpQuery, matchingFaq(app).length)}</p>}
          <ul className="phone-list">
            {matchingFaq(app).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <button type="button" className="phone-button primary" onClick={() => call("contact_support")}>
            {t.buttons.contact}
          </button>
        </>
      );
    case "support":
      return (
        <>
          <p className="phone-note">{t.supportIntro}</p>
          {app.messages.map((m, i) => (
            <p className="bubble" key={i}>
              {m}
            </p>
          ))}
          <TextTool placeholder={t.inputs.message} go={t.inputs.go} onSubmit={(text) => call("send_message", { text })} />
        </>
      );
  }
}
