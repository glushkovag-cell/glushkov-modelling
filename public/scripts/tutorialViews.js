document.addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('.tutorial-detail');
    const idAttr = article && article.dataset ? article.dataset.tutorialId : null;
    const tutorialId = idAttr ? Number(idAttr) : 0;

    const body = document.body;
    const baseUrl = body ? body.getAttribute('data-wp-rest-url') : null;

    if (!tutorialId || !baseUrl) {
        return;
    }

    fetch(baseUrl + '/glushkov/v1/tutorial-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tutorialId }),
    }).catch(() => {
        // намеренно игнорируем ошибку
    });
});