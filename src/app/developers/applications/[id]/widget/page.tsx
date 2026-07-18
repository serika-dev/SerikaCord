"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader } from "@/components/ui/Loader";

// The widget editor now lives full-screen at /widget-editor/[appId].
export default function WidgetEditorRedirect() {
  const router = useRouter();
  const params = useParams();
  const appId = params.id as string;

  useEffect(() => {
    router.replace(`/widget-editor/${appId}`);
  }, [appId, router]);

  return <div className="flex items-center justify-center h-64"><Loader /></div>;
}
