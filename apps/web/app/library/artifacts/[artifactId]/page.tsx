import { LibraryDetailView } from "../../library-detail-view";

type ArtifactDetailPageProps = {
  params: Promise<{
    artifactId: string;
  }>;
};

export default async function ArtifactDetailPage({ params }: ArtifactDetailPageProps) {
  const { artifactId } = await params;
  return <LibraryDetailView id={artifactId} kind="artifact" />;
}
