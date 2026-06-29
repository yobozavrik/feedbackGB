import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { ToolsClient } from "./tools-client";

export const dynamic = "force-dynamic";

export default function ToolsPage() {
  return (
    <AdminPageContainer
      title="Інструменти"
      subTitle="Ручний звіт, дзеркало фото у Drive, експорт фідбеків"
    >
      <ToolsClient />
    </AdminPageContainer>
  );
}
