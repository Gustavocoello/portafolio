import React, { useEffect, useRef, useState } from "react";
import { sendContact } from "@/projects/voice-sphere/tarsApi";
import "./TarsContactModal.css";

export default function TarsContactModal({ onClose }) {
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setStatus("sending");
    setError("");
    try {
      await sendContact(data);
      setStatus("sent");
    } catch (err) {
      setError(err.message);
      setStatus("idle");
    }
  };

  return (
    <div className="tars-modal-backdrop">
      <div className="tars-modal" role="dialog" aria-modal="true" aria-labelledby="tars-modal-title">
        <button type="button" className="tars-modal-close" onClick={onClose} aria-label="Close and go back">
          ×
        </button>

        <p className="tars-modal-alert" role="alert">Private project</p>
        <h2 id="tars-modal-title">TARS is only available to its owner</h2>
        <p className="tars-modal-text">
          TARS works with my personal email, calendar and notes, so it is not open to the public.
          Would you like a demo, or to build something similar? Contact me.
        </p>

        {status === "sent" ? (
          <p className="tars-modal-sent" role="status">Thank you. I will get back to you soon.</p>
        ) : (
          <form className="tars-modal-form" onSubmit={submit}>
            <fieldset>
              <legend>I would like to</legend>
              <label className="tars-modal-option">
                <input type="radio" name="reason" value="demo" defaultChecked /> See a demo of TARS
              </label>
              <label className="tars-modal-option">
                <input type="radio" name="reason" value="similar" /> Build something similar
              </label>
            </fieldset>
            <label>
              Name
              <input ref={firstField} name="name" required maxLength={120} autoComplete="name" />
            </label>
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label>
              Message
              <textarea name="message" rows={4} required maxLength={4000} />
            </label>
            {error && <p className="tars-modal-error" role="alert">{error}</p>}
            <button type="submit" className="tars-modal-submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
