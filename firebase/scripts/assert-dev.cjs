// CODEX HANDOFF: deployment guard. Keep this until an explicit production project/alias is designed.
const project = process.env.GCLOUD_PROJECT;
if (project !== 'hazcom-navigator-dev') throw new Error('HazCom deployments are restricted to hazcom-navigator-dev.');
