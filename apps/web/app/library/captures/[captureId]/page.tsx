import { LibraryDetailView } from "../../library-detail-view";

type CaptureDetailPageProps = {
  params: Promise<{
    captureId: string;
  }>;
};

export default async function CaptureDetailPage({ params }: CaptureDetailPageProps) {
  const { captureId } = await params;
  return <LibraryDetailView id={captureId} kind="capture" />;
}
