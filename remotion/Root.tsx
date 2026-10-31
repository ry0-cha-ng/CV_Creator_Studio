import type { ReactNode } from 'react';
import { Composition } from 'remotion';
import { createDefaultProject, projectSchema } from '../shared/schema/project';
import { LineupThumbnail } from './LineupThumbnail';
import { LongVideo, type LongVideoProps } from './long/LongVideo';
import { buildRenderPlan } from '../shared/long/render-plan';
import { createLongProject } from '../shared/long/templates';
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

const defaultLongProps: LongVideoProps = {
  plan: buildRenderPlan(createLongProject({ id: 'preview', title: 'preview', template: null, now: '2026-01-01T00:00:00.000Z' }), {
    language: 'ja',
  }),
  mediaBaseUrl: 'studio-media://root',
  useProxy: false,
};

export const RemotionRoot = (): ReactNode => (
  <>
    <Composition
      id="LongVideo"
      component={LongVideo}
      width={1920}
      height={1080}
      fps={60}
      durationInFrames={1}
      defaultProps={defaultLongProps}
      calculateMetadata={({ props }) => ({
        width: props.plan.width,
        height: props.plan.height,
        fps: props.plan.fps,
        durationInFrames: Math.max(1, props.plan.durationInFrames),
      })}
    />
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
