# AI Subjects (main_admin.htm → "AI Subjects")

Generate a whole subject for a **University course** or a **Tutor course**: outline → every lesson
(MedPhysio-format mini-text, model structured answer, quiz) → optional YouTube videos → review → publish.

## Setup
- `OPENAI_API_KEY` (already used by the other AI features). Optional `SUBJECT_AI_MODEL` (default `gpt-4o-mini`).
- Optional YouTube suggestions: set `YOUTUBE_API_KEY` (YouTube Data API v3). Without it the admin still gets a
  "Search YouTube" link per lesson and can paste a URL.
- Restart `server.js` (new routes + CSP now allows YouTube/Drive iframes and ytimg thumbnails).
- No Firestore rule/index changes needed (admin writes; topics reuse `courseTopics` / `tutorTopics`).

## Files
New: `ai-subjects-admin.js`, `subject-shared.js`, `subject.htm`, `subject-lesson.htm`, `medphysio.css`
Edited: `main_admin.htm` (sidebar button, section, showSection hook, script include), `server.js`
(`/api/ai/subject-outline|subject-lesson|youtube-search|subject-ask`), `lesson.htm`,
`course-lectures*.htm`, `tutor-course-viewer.html` (route AI topics to the new viewer).

## Data
Topics carry `contentFormat:'medphysio'`, `aiGenerated:true`, `aiSubjectId`, `miniTextHtml`, `structuredAnswerHtml`,
`fullLectureEmbed`, `answerVideoEmbed`, `relatedVideos[]`, and an inline `quizQuestions[]`.
