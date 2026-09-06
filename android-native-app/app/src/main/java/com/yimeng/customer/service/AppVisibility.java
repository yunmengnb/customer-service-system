// 忆梦云团队开发
package com.yimeng.customer.service;

final class AppVisibility {
    private static volatile boolean foreground;

    private AppVisibility() {}

    static boolean isForeground() {
        return foreground;
    }

    static void setForeground(boolean value) {
        foreground = value;
    }
}
