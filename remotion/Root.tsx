import type { ReactNode } from 'react';
import { Composition } from 'remotion';
import { createDefaultProject, projectSchema } from '../shared/schema/project';
import { LineupThumbnail } from './LineupThumbnail';
import {
  LineupCard,
  LineupCardX45,
  LineupShortStandard,
  getDurationInFrames,
  type LineupShortProps,
} from './LineupShortStandard';

const defaultProject = createDefaultProject('preview');
const defaultProps: LineupShortProps = {
  project: defaultProject,
  language: 'ja',
  mediaBaseUrl: 'studio-media://root',
  useOriginalMedia: false,
};

export const RemotionRoot = (): ReactNode => (
  <>
    <Composition
      id="LineupShortStandard"
      component={LineupShortStandard}
      width={1080}
      height={1920}
      fps={60}
      durationInFrames={getDurationInFrames(defaultProject)}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const project = projectSchema.parse(props.project);
        return {
          fps: project.templateParams.fps,
          durationInFrames: getDurationInFrames(project),
          props: { ...props, project },
        };
      }}
    />
    <Composition
      id="LineupCard"
      component={LineupCard}
      width={1080}
      height={1920}
      fps={60}
      durationInFrames={1}
      defaultProps={defaultProps}
    />
    <Composition
      id="LineupCardX45"
      component={LineupCardX45}
      width={1080}
      height={1350}
      fps={60}
      durationInFrames={1}
      defaultProps={defaultProps}
    />
    <Composition
      id="LineupThumbnail"
      component={LineupThumbnail}
      width={1080}
      height={1920}
      fps={60}
      durationInFrames={1}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const project = projectSchema.parse(props.project);
        return {
          fps: project.templateParams.fps,
          durationInFrames: 1,
          props: { ...props, project },
        };
      }}
    />
  </>
);
