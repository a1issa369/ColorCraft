import type { Adjustments, Img } from '../core/types.ts';
import type { Analysis } from '../core/analyze.ts';
import type { Mask } from '../core/mask.ts';
import type { Finding } from '../core/suggest.ts';
import type { LookProfile } from '../core/transfer.ts';
import type { Swatch } from '../core/palette.ts';

/** A reference photo whose grade is being copied. */
export interface RefMatch {
  id: number;
  profile: LookProfile;
  color: number;     // 0..1
  tone: number;      // 0..1
  thumb: Img;
  swatches: Swatch[];
}

/** Everything that makes up an edit. Undo and redo step through these. */
export interface Settings {
  adj: Adjustments;
  look: string | null;
  lookStrength: number;
  ref: RefMatch | null;
  masks: Mask[];
  maskSel: string | null;
}

export type TabId = 'read' | 'adjust' | 'curves' | 'look' | 'match' | 'masks';
export const TABS: { id: TabId; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'curves', label: 'Curves' },
  { id: 'look', label: 'Looks' },
  { id: 'match', label: 'Match' },
  { id: 'masks', label: 'Masks' },
];

/** Everything the screen is drawn from. */
export interface EditorState {
  photoId: number;            // changes whenever a new photo is opened
  hasPhoto: boolean;
  settings: Settings;
  split: number;              // 0..1, how much of the photo shows the original
  hold: boolean;              // showing the original in full
  tab: TabId;
  maskArea: boolean;          // red overlay while editing a mask
  brush: { size: number; soft: number; erase: boolean };   // the paintbrush tool: radius as a fraction of the photo's width
  findings: Finding[];
  stats: Analysis | null;     // of the graded preview
  canUndo: boolean;
  canRedo: boolean;
  notice: string;             // short message under the settings buttons
  error: string;              // problem opening a photo
}
