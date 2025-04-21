<?php
/*
Plugin Name: RAG Plugin
Description: Adds a custom block-editor sidebar that calls an external RAG service.
*/

function rag_plugin_enqueue_assets() {
    // Register the sidebar JS
    wp_register_script(
        'rag-plugin-sidebar-js',
        plugins_url( 'rag-plugin-sidebar.js', __FILE__ ),
        array(
            'wp-plugins',
            'wp-edit-post',
            'wp-element',
            'wp-components',
            'wp-data',
            'wp-i18n',
        ),
        '1.0',
        true
    );

    // Register optional sidebar CSS for layout
    wp_register_style(
        'rag-plugin-sidebar-css',
        plugins_url( 'rag-plugin-sidebar.css', __FILE__ )
    );

    // Enqueue them for the block editor only
    wp_enqueue_script( 'rag-plugin-sidebar-js' );
    wp_enqueue_style( 'rag-plugin-sidebar-css' );
}
add_action( 'enqueue_block_editor_assets', 'rag_plugin_enqueue_assets' );

/**
 * Optional: If you need to store or retrieve data from the WP database,
 * you can define REST routes or handle form inputs here as needed.
 */
