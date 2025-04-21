( function ( wp ) {
    const { createElement: el, useState } = wp.element;
    const { registerPlugin } = wp.plugins;
    const { __ } = wp.i18n; // For translations
    const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost;
    const { Button, TextControl, Spinner, PanelBody, SelectControl } = wp.components;

    function RAGSidebarInterface() {
        const [ userInput, setUserInput ] = useState('');
        const [ loading, setLoading ] = useState(false);
        const [ responseData, setResponseData ] = useState('');
        const [ history, setHistory ] = useState([]);

        // Example function to call your external RAG endpoint
        async function handleRAGRequest() {
            setLoading(true);
            setResponseData('');
            try {
                const resp = await fetch('/wp-json/rag-plugin/v1/queries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: userInput })
                });
                const data = await resp.json();
                setResponseData(data?.response || __('No data returned', 'rag-plugin'));
            } catch (error) {
                setResponseData(__('Error: ', 'rag-plugin') + error.message);
            }
            setLoading(false);
        }

        return el(
            'div',
            { className: 'rag-plugin-sidebar-content' },
            el(PanelBody, { title: __('Ask the RAG Service', 'rag-plugin'), initialOpen: true },
                el(TextControl, {
                    label: __('User Query', 'rag-plugin'),
                    value: userInput,
                    onChange: (val) => setUserInput(val)
                }),
                el(SelectControl, {
                    label: __('Response Format', 'rag-plugin'),
                    value: responseFormat,
                    options: [
                        { label: __('Plain Text', 'rag-plugin'), value: 'text' },
                        { label: __('HTML', 'rag-plugin'), value: 'html' },
                        { label: __('Markdown', 'rag-plugin'), value: 'markdown' },
                    ],
                    onChange: (val) => setResponseFormat(val)
                }),
                el(Button, {
                    isPrimary: true,
                    onClick: handleRAGRequest
                }, __('Send to RAG', 'rag-plugin')),
                loading && el(Spinner, null),
                responseData && el('p', null, responseData)
            ),
            el(PanelBody, { title: __('RAG History', 'rag-plugin'), initialOpen: false },
                el(Button, { onClick: loadHistory }, __('Load Recent Queries', 'rag-plugin')),
                loading && el(Spinner, null),
                history && history.length > 0 && el('div', null,
                    history.map((item) => (
                        el('div', { key: item.id, className: 'rag-query-item' },
                            el('p', null, __('Query:', 'rag-plugin') + ' ' + item.query_text),
                            el('p', null, __('Response:', 'rag-plugin') + ' ' + (item.response_text || '...')),
                            el('p', null, __('Created At:', 'rag-plugin') + ' ' + item.created_at),
                            el('hr', null)
                        )
                    ))
                )
            )
        );
    }

    // Register the plugin to add an icon + item in the editor's "More Menu"
    registerPlugin( 'rag-plugin-sidebar', {
        icon: 'admin-site-alt3',
        render: function() {
            return (
                el( wp.element.Fragment, null,
                    el(PluginSidebarMoreMenuItem, {
                        target: 'rag-plugin-sidebar'
                    }, __('RAG Sidebar', 'rag-plugin')),
                    el(PluginSidebar, {
                        name: 'rag-plugin-sidebar',
                        title: __('RAG Sidebar', 'rag-plugin'),
                        icon: 'admin-site-alt3'
                    },
                    el(RAGSidebarInterface)
                    )
                )
            );
        }
    });
} )( window.wp );
