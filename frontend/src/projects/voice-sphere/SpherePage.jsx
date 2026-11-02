import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactiveSphere from "@/projects/voice-sphere/ReactiveSphere";
import TarsContactModal from "@/projects/voice-sphere/TarsContactModal";
import { useAuthContext } from "@/core/auth/AuthContext";
import { hearTars, isTarsOwner, replyTars } from "@/projects/voice-sphere/tarsApi";

export default function SpherePage() {
  const { getToken } = useAuthContext();
  const navigate = useNavigate();
  const [owner, setOwner] = useState(null); // null mientras se consulta

  useEffect(() => {
    isTarsOwner(getToken).then(setOwner).catch(() => setOwner(false));
  }, [getToken]);

  const tars = useMemo(() => ({
    hear: (blob, wake) => hearTars(blob, wake, getToken),
    reply: (text) => replyTars(text, getToken),
  }), [getToken]);

  return (
    <>
      <ReactiveSphere tars={owner ? tars : null} />
      {owner === false && <TarsContactModal onClose={() => navigate("/")} />}
    </>
  );
}
