export function initTutorialViews() {
    document.addEventListener('DOMContentLoaded', () => {
        const article = document.querySelector<HTMLElement>('.tutorial-detail');
        const idAttr = article?.dataset.tutorialId; // data-tutorial-id
        const tutorialId = idAttr ? Number(idAttr) : 0;
        const baseUrl = import.meta.env.PUBLIC_WP_REST_URL;

        console.log('initTutorialViews: tutorialId, baseUrl:', tutorialId, baseUrl);

        if (!tutorialId || !baseUrl) return;

        fetch(`${baseUrl}/glushkov/v1/tutorial-view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: tutorialId }),
        }).catch((err) => {
            console.error('Failed to increment tutorial views', err);
        });
    });
}