# Meeting Connect

Meeting Connect is a demo product context for connecting a self-built business page with Feishu meetings, Feishu Base, and Feishu meeting notes.

## Language

**Self-built business page**:
The customer-facing product surface where a user starts a Feishu meeting and sees meeting progress. It is not the source of truth for meeting records.
_Avoid_: internal page, custom page

**Customer builder**:
The customer-side evaluator who understands self-built pages, data tables, and integration workflows. The demo should make implementation feasibility and product experience visible without turning the main surface into a raw debug console.
_Avoid_: pure business viewer, non-technical viewer

**Integration Console**:
The intended product shape of the self-built business page demo for a **Customer builder**. It shows the business loop, integration readiness, and technical acceptance details in separate layers so feasibility is visible without exposing raw debugging as the primary experience.
_Avoid_: business-only dashboard, raw API debugger, marketing landing page

**Primary demo surface**:
The first screen of the **Integration Console**. It should explain the Feishu meeting open capability once, then focus on the user's next action, current meeting state, data-table writeback, and useful technical proof. Static readiness labels and repeated explanation copy should be removed or moved into the technical layer.
_Avoid_: repeated demo slogans, dead readiness badges, duplicated login prompts

**Meeting owner identity**:
The Feishu OpenID of the current SSO-authenticated user. The self-built business page uses this current user as the owner when creating a Feishu meeting.
_Avoid_: fixed owner in the page, event receiver OpenID, tenant token identity, mandatory identity comparison

**Authenticated meeting creation**:
The product rule that a Feishu meeting can only be created after SSO login has resolved the **meeting owner identity**. The page does not support a configured fixed owner.
_Avoid_: anonymous meeting creation, config-driven page owner, fixed owner fallback

**Meeting event receiver**:
The Feishu application callback that receives meeting lifecycle events such as recording-ready. Event receiving is an application capability and should not be described as using a specific user OpenID.
_Avoid_: owner receives the event, user receives the event

**Recording retrieval**:
The process of fetching meeting recording metadata after the recording-ready event. Feishu supports tenant access token for tenant-scope recording retrieval, while user access token is constrained by the meeting owner.
_Avoid_: user-only recording retrieval

**Feishu meeting**:
A real Feishu video meeting created through Feishu OpenAPI. One **Feishu meeting** has one **meeting record** in the **meeting Base**.
_Avoid_: mock meeting, demo meeting

**Meeting Base**:
The real Feishu Base that stores meeting records and meeting-note sync results. It is generated through Feishu OpenAPI and is the source of truth for customer demo data.
_Avoid_: local table, page table, local JSON, demo table, manually prepared Base

**Internet-readable Meeting Base**:
The sharing boundary for the **Meeting Base**: anyone with the link can read it, but only the owner user and application can edit it.
_Avoid_: internet-editable Base, public write access

**Local fallback cache**:
A local JSON persistence layer used only when the real **Meeting Base** is not configured or temporarily unavailable. It must not be presented as the **Meeting Base** in customer demos.
_Avoid_: Base, multi-dimensional table, data table

**Meeting record**:
One row in the **Meeting Base** representing a Feishu meeting and its downstream note-sync state.
_Avoid_: local record

**Meeting note sync**:
The process of bringing Feishu intelligent meeting-note metadata or demo note content back to the **Meeting Base** and the self-built business page.
_Avoid_: summary upload, note import

**Automated meeting note sync**:
The event-driven flow that starts from Feishu's recording-ready event, extracts the minutes token from the recording URL, reads minutes metadata and AI artifacts, and updates the existing **meeting record** in the **Meeting Base**.
_Avoid_: manual note sync, button-only sync

## Example Dialogue

Dev: "Can we show the page table if Base is not configured?"
Domain expert: "Only as a local fallback cache. For a customer demo, the Meeting Base must be a real Feishu Base."

Dev: "Where should the meeting-note result be saved?"
Domain expert: "Update the existing meeting record in the Meeting Base, then reflect that state on the self-built business page."
