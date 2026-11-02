/**
 * Built-in compute panels. Import once from the compute sidebar so registration
 * runs before the first picker selection.
 */

import {
  CLUSTER_ANALYSIS_ID,
  MSD_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
} from "@molcrafts/molvis-stage";
import { ClusterPanel } from "../ClusterPanel";
import { PCA_ANALYSIS_ID, PCATool } from "../PCATool";
import { registerComputePanel } from "./compute_panels";
import {
  GLOBAL_DENSITY_ANALYSIS_ID,
  GlobalDensityPanel,
} from "./GlobalDensityPanel";
import { MsdPanel } from "./MsdPanel";
import { RdfPanel } from "./RdfPanel";
import { RINGS_ANALYSIS_ID, RingsPanel } from "./RingsPanel";

registerComputePanel({
  id: RDF_ANALYSIS_ID,
  ownsAtomScope: true,
  render: (p) => (
    <RdfPanel
      app={p.app}
      frameRange={p.frameRange}
      trajectoryLength={p.trajectoryLength}
      scopeBlocked={p.scopeBlocked}
    >
      {p.scopeNode}
    </RdfPanel>
  ),
});

registerComputePanel({
  id: MSD_ANALYSIS_ID,
  ownsAtomScope: true,
  render: (p) => (
    <MsdPanel
      app={p.app}
      frameRange={p.frameRange}
      trajectoryLength={p.trajectoryLength}
      scopeBlocked={p.scopeBlocked}
    >
      {p.scopeNode}
    </MsdPanel>
  ),
});

registerComputePanel({
  id: CLUSTER_ANALYSIS_ID,
  ownsAtomScope: true,
  render: (p) => <ClusterPanel app={p.app} />,
});

registerComputePanel({
  id: PCA_ANALYSIS_ID,
  ownsAtomScope: true,
  render: (p) => <PCATool app={p.app} />,
});

registerComputePanel({
  id: RINGS_ANALYSIS_ID,
  ownsAtomScope: true,
  render: (p) => <RingsPanel app={p.app} />,
});

registerComputePanel({
  id: GLOBAL_DENSITY_ANALYSIS_ID,
  ownsAtomScope: true,
  render: (p) => (
    <GlobalDensityPanel app={p.app}>{p.scopeNode}</GlobalDensityPanel>
  ),
});
