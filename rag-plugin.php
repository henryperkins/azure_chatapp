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
 * Register REST endpoint for storing/retrieving RAG queries
 */
function rag_plugin_register_rest_routes() {
    // Create database table on plugin activation
    function rag_plugin_activate() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'rag_queries';
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE $table_name (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            query_text text NOT NULL,
            response_text text,
            user_id bigint(20) NOT NULL,
            created_at datetime DEFAULT '0000-00-00 00:00:00' NOT NULL,
            PRIMARY KEY  (id)
        ) $charset_collate;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    register_activation_hook(__FILE__, 'rag_plugin_activate');

    function rag_plugin_handle_query($request) {
        $params = $request->get_json_params();
        $query = sanitize_text_field($params['query']);
        
        // Store the query
        global $wpdb;
        $table = $wpdb->prefix . 'rag_queries';
        $wpdb->insert($table, [
            'query_text' => $query,
            'user_id'    => get_current_user_id(),
            'created_at' => current_time('mysql')
        ]);
        
        // Call external RAG service (replace with your actual endpoint)
        $rag_response = wp_remote_post('https://your-rag-service.com/api', [
            'body' => json_encode(['query' => $query]),
            'headers' => [
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . get_option('rag_api_key') // Store API key in settings
            ]
        ]);
        
        if (is_wp_error($rag_response)) {
            return new WP_REST_Response([
                'success' => false,
                'message' => 'RAG service error: ' . $rag_response->get_error_message()
            ], 500);
        }
        
        $response_data = json_decode(wp_remote_retrieve_body($rag_response), true);
        
        // Update with response
        $wpdb->update($table, 
            ['response_text' => sanitize_text_field($response_data['answer'])],
            ['id' => $wpdb->insert_id]
        );
        
        return new WP_REST_Response([
            'success' => true,
            'response' => $response_data['answer']
        ], 200);
    }

    register_rest_route('rag-plugin/v1', '/queries', array(
        'methods' => 'POST',
        'callback' => 'rag_plugin_handle_query',
        'permission_callback' => function() {
            return current_user_can('edit_posts');
        }
    ));
}
add_action('rest_api_init', 'rag_plugin_register_rest_routes');
